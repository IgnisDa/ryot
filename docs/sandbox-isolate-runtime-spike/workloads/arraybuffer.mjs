export default () => { const bufs = []; for (let i = 0; i < 30; i++) bufs.push(new Uint8Array(25 << 20).fill(1)); return bufs.length; };
