import * as fs from 'fs';
import * as path from 'path';

const cssPath = 'c:/Users/Azad Singh/Desktop/upbus/apps/web-app/src/app/globals.css';
const cssContent = fs.readFileSync(cssPath, 'utf-8');

const lines = cssContent.split('\n');
lines.forEach((line, i) => {
  if (line.includes('pulse-ring') || line.includes('pulse')) {
    console.log(`Line ${i + 1}: ${line}`);
  }
});
