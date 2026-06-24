const fs = require('fs');

const code = fs.readFileSync('src/db/index.ts', 'utf8');

// Find the mockDb variable
const mockDbStartIndex = code.indexOf('const mockDb = {');
if (mockDbStartIndex !== -1) {
  let depth = 0;
  let mockDbEndIndex = -1;
  
  for (let i = mockDbStartIndex + 'const mockDb = '.length; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) {
        mockDbEndIndex = i + 1;
        break;
      }
    }
  }

  if (mockDbEndIndex !== -1) {
    const mockDbString = code.substring(mockDbStartIndex + 'const mockDb = '.length, mockDbEndIndex);
    // Parse it securely by evaluating in a function scope or just eval since it's our own code
    const mockDb = eval('(' + mockDbString + ')');
    fs.writeFileSync('src/db/data.json', JSON.stringify(mockDb, null, 2));
    console.log('Successfully wrote src/db/data.json');
  } else {
    console.log('Could not find end of mockDb');
  }
} else {
  console.log('Could not find mockDb');
}
