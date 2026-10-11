export const PVP_COOLDOWN_MS = 10_000;
export const PVP_INVITE_MS = 120_000;
export const PVP_TURN_MS = 60_000;
export const PVP_MAX_STAKE = 5000; // Paymenter's maximum mutation is 10,000 (the full pot).
export function rpsWinner(a, b) {
    if (!['rock', 'paper', 'scissors'].includes(a) || !['rock', 'paper', 'scissors'].includes(b))
        throw new Error('Invalid RPS choice.');
    if (a === b)
        return null;
    return ({ rock: 'scissors', paper: 'rock', scissors: 'paper' })[a] === b ? 0 : 1;
}
export function boardWinner(board, width, height, length) {
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const player = board[y * width + x];
            if (player == null)
                continue;
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                let count = 1;
                for (; count < length; count++) {
                    const nx = x + dx * count, ny = y + dy * count;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height || board[ny * width + nx] !== player)
                        break;
                }
                if (count === length)
                    return player;
            }
        }
    return null;
}
export function placeMove(game, board, player, position) {
    const next = [...board];
    if (!Number.isSafeInteger(position))
        throw new Error('Choose a valid position.');
    if (game === 'tictactoe') {
        if (position < 0 || position > 8 || next[position] !== null)
            throw new Error('That square is unavailable.');
        next[position] = player;
    }
    else {
        if (position < 0 || position > 6)
            throw new Error('Choose a column from 1 to 7.');
        let row = 5;
        while (row >= 0 && next[row * 7 + position] !== null)
            row--;
        if (row < 0)
            throw new Error('That column is full.');
        next[row * 7 + position] = player;
    }
    const winner = game === 'tictactoe' ? boardWinner(next, 3, 3, 3) : boardWinner(next, 7, 6, 4);
    return { board: next, winner, draw: winner === null && next.every(cell => cell !== null) };
}
