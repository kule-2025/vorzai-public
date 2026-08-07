const fn = new Function('result', 'result.result >= 10');
const arg = { result: 10 };
console.log('fn result:', fn(arg));
console.log('type:', typeof fn(arg));
console.log('10 >= 10:', 10 >= 10);
console.log('Boolean:', Boolean(fn(arg)));
