import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GROQ_API_KEY = 'gsk_voice_test_key';
process.env.OPENROUTER_API_KEY = 'sk-or-voice-test-key';
const { voiceAssistant, VoiceAssistant, pcmToWav, containsAudibleSpeech, speechText, VOICE_TTS_MODEL } = await import('../dist/services/voiceAssistant.js');

test('Discord PCM becomes a valid 16 kHz mono WAV for speech recognition', () => {
    const pcm = Buffer.alloc(3200);
    const wav = pcmToWav(pcm);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.equal(wav.length, pcm.length + 44);
});

test('silent audio is ignored before a metered transcription request', () => {
    assert.equal(containsAudibleSpeech(Buffer.alloc(32_000)), false);
    const speech = Buffer.alloc(32_000);
    for (let offset = 0; offset < speech.length; offset += 2) speech.writeInt16LE(offset % 4 ? 1_000 : -1_000, offset);
    assert.equal(containsAudibleSpeech(speech), true);
});

test('voice requests use the transcription and Fish speech endpoints with bounded payloads', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/audio/transcriptions')) {
            const form = init.body;
            assert.equal(form.get('model'), 'whisper-large-v3');
            assert.match(form.get('prompt'), /Victus Cloud/);
            const file = form.get('file');
            assert.equal(file.type, 'audio/wav');
            assert.equal(Buffer.from(await file.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
            return Response.json({ text: 'How can I back up my server?' });
        }
        if (String(url).endsWith('/audio/speech')) {
            const body = JSON.parse(init.body);
            assert.equal(body.model, VOICE_TTS_MODEL);
            assert.equal(body.response_format, 'mp3');
            assert.equal(body.input, 'Use the backup page.');
            return new Response(Buffer.from('ID3fake-audio'), { headers: { 'content-type': 'audio/mpeg' } });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };
    try {
        const transcript = await voiceAssistant.transcribe({ userId: '123', pcm: Buffer.alloc(3200), durationMs: 100 });
        assert.equal(transcript, 'How can I back up my server?');
        const audio = await voiceAssistant.synthesize('Use the backup page.');
        assert.equal(audio.toString(), 'ID3fake-audio');
        assert.equal(calls.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('speech output strips markdown and links', () => {
    assert.equal(speechText('**Hello**! Read https://example.com/docs for help.'), 'Hello! Read for help.');
});

test('Fish free-tier 429 pauses speech requests instead of repeatedly hitting quota', async () => {
    const assistant = new VoiceAssistant();
    const originalFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; return Response.json({ error: { message: 'quota exhausted' } }, { status: 429 }); };
    assistant.synthesizeEdge = async () => Buffer.from('ID3fallback-audio');
    try {
        assert.equal((await assistant.synthesize('Hello')).toString(), 'ID3fallback-audio');
        assert.equal((await assistant.synthesize('Hello again')).toString(), 'ID3fallback-audio');
        assert.equal(attempts, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('voice reply failures never turn into a text answer', async () => {
    const assistant = new VoiceAssistant();
    let textMessages = 0;
    assistant.channel = { send: async () => { textMessages++; } };
    assistant.transcribe = async () => 'How do I make a backup?';
    assistant.answer = async () => 'Open Backups and create one.';
    assistant.synthesize = async () => { throw new Error('No speech service available'); };
    await assert.rejects(assistant.respond({ userId: '123', pcm: Buffer.alloc(0), durationMs: 1000 }), /No speech service available/);
    assert.equal(textMessages, 0);
});
