console.log('process.argv:', process.argv);
const indexOfThunderBun = process.argv.findIndex((arg) => arg.includes('thunderbun'));
console.log('indexOfThunderBun:', indexOfThunderBun);
const commandArg = process.argv[indexOfThunderBun + 1] || 'build';
console.log('commandArg:', commandArg);
