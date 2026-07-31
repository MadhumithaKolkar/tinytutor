// String.raw so the backslashes in the ASCII art are treated literally.
const ART = String.raw`
 _   _             _         _
| |_(_)_ __  _   _| |_ _   _| |_ ___  _ __
| __| | '_ \| | | | __| | | | __/ _ \| '__|
| |_| | | | | |_| | |_| |_| | || (_) | |
 \__|_|_| |_|\__, |\__|\__,_|\__\___/|_|
             |___/
`;

const BANNER = `${ART}   understand what you ship\n`;

module.exports = { BANNER };
