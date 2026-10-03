export default (input) => { globalThis.__secret = input.secret; Object.prototype.polluted = input.secret; return { set: true }; };
