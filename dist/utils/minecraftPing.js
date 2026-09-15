import net from 'node:net';
/**
 * Encode a number as a Minecraft VarInt Buffer
 */
export function writeVarInt(val) {
    const bytes = [];
    let v = val;
    while (true) {
        if ((v & ~0x7f) === 0) {
            bytes.push(v);
            break;
        }
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    return Buffer.from(bytes);
}
/**
 * Parse host and port from a connection address string (e.g., "node.example.com:25565" or "node.example.com")
 */
export function parseAddress(addr, defaultPort = 25565) {
    if (!addr || typeof addr !== 'string')
        return null;
    const clean = addr.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!clean)
        return null;
    if (clean.includes(':')) {
        const [host, portStr] = clean.split(':');
        const port = parseInt(portStr, 10);
        if (host && Number.isFinite(port) && port > 0 && port <= 65535) {
            return { host, port };
        }
    }
    return { host: clean, port: defaultPort };
}
/**
 * Perform a standard Minecraft Server List Ping (SLP) handshake over TCP
 */
export function pingMinecraft(host, port, timeoutMs = 2500) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const socket = new net.Socket();
        let buffer = Buffer.alloc(0);
        let settled = false;
        const finish = (result) => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(result);
            }
        };
        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => finish(null));
        socket.on('error', () => finish(null));
        socket.connect(port, host, () => {
            try {
                const hostBuf = Buffer.from(host, 'utf8');
                const portBuf = Buffer.alloc(2);
                portBuf.writeUInt16BE(port, 0);
                // Handshake packet (ID 0x00, protocol 765, host, port, next state 1 = status)
                const packetData = Buffer.concat([
                    writeVarInt(0x00),
                    writeVarInt(765),
                    writeVarInt(hostBuf.length),
                    hostBuf,
                    portBuf,
                    writeVarInt(1),
                ]);
                const handshake = Buffer.concat([writeVarInt(packetData.length), packetData]);
                socket.write(handshake);
                // Status request packet (Length 1, ID 0x00)
                const statusReq = Buffer.concat([writeVarInt(1), writeVarInt(0x00)]);
                socket.write(statusReq);
            }
            catch {
                finish(null);
            }
        });
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            const str = buffer.toString('utf8');
            const startIdx = str.indexOf('{');
            const endIdx = str.lastIndexOf('}');
            if (startIdx !== -1 && endIdx > startIdx) {
                try {
                    const parsed = JSON.parse(str.substring(startIdx, endIdx + 1));
                    const latencyMs = Date.now() - startTime;
                    const playersObj = parsed.players || {};
                    const playersOnline = Math.max(0, Number(playersObj.online ?? 0));
                    const playersMax = Math.max(0, Number(playersObj.max ?? 20));
                    const playerSample = [];
                    if (Array.isArray(playersObj.sample)) {
                        for (const s of playersObj.sample) {
                            if (s?.name && typeof s.name === 'string') {
                                playerSample.push(s.name.replace(/§[0-9a-fk-or]/gi, '').trim());
                            }
                        }
                    }
                    let motd = null;
                    if (typeof parsed.description === 'string') {
                        motd = parsed.description.replace(/§[0-9a-fk-or]/gi, '').trim();
                    }
                    else if (parsed.description?.text) {
                        motd = String(parsed.description.text).replace(/§[0-9a-fk-or]/gi, '').trim();
                    }
                    const versionName = parsed.version?.name ? String(parsed.version.name).trim() : null;
                    finish({
                        online: true,
                        playersOnline,
                        playersMax,
                        playerSample,
                        versionName,
                        motd,
                        latencyMs,
                    });
                }
                catch {
                    // Buffer may still be receiving more chunks of JSON
                }
            }
        });
        socket.on('close', () => finish(null));
    });
}
/**
 * Ping a server trying its directAddress first, then connectHostname / ip as fallback
 */
export async function pingServerWithFallback(server, timeoutMs = 2500) {
    const candidates = [];
    // 1. Direct address (host:port directly on the node)
    const direct = parseAddress(server.directAddress);
    if (direct)
        candidates.push(direct);
    // 2. Connect hostname (e.g. custom domain or subdomain)
    const connect = parseAddress(server.connectHostname);
    if (connect && (!direct || direct.host !== connect.host || direct.port !== connect.port)) {
        candidates.push(connect);
    }
    // 3. Fallback IP
    const ipParsed = parseAddress(server.ip);
    if (ipParsed &&
        (!direct || direct.host !== ipParsed.host || direct.port !== ipParsed.port) &&
        (!connect || connect.host !== ipParsed.host || connect.port !== ipParsed.port)) {
        candidates.push(ipParsed);
    }
    for (const cand of candidates) {
        const res = await pingMinecraft(cand.host, cand.port, timeoutMs);
        if (res && res.online) {
            return res;
        }
    }
    return null;
}
/**
 * Execute promises in batches to control concurrency
 */
export async function runWithConcurrency(items, limit, fn) {
    const executing = [];
    for (const item of items) {
        const p = fn(item).then(() => {
            executing.splice(executing.indexOf(p), 1);
        });
        executing.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);
}
