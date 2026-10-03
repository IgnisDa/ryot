export default () => { const a = []; for (let i = 0; ; i++) { a.push({ x: new Array(64).fill(i) }); if (i % 100000 === 0) console.log("iter", i, a.length); } };
