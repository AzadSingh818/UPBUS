require('ts-node').register();
const { buildGraph, findPathsDFS } = require('./src/engine/graph');

async function test() {
  await buildGraph();
  console.log('Testing Saharanpur to Gangoh...');
  const paths1 = findPathsDFS('Saharanpur', 'Gangoh');
  console.log(`Found ${paths1.length} paths`);
  paths1.forEach((p, i) => {
    console.log(`Path ${i + 1}: ${p.legs.map(l => l.routeName).join(' -> ')}`);
    console.log(`Stops: ${p.legs[0].stops.map(s => s.name).join(' -> ')}`);
  });

  console.log('\nTesting Saharanpur to Meerut...');
  const paths2 = findPathsDFS('Saharanpur', 'Meerut');
  console.log(`Found ${paths2.length} paths`);
  paths2.forEach((p, i) => {
    console.log(`Path ${i + 1}: ${p.legs.map(l => l.routeName).join(' -> ')}`);
  });

  console.log('\nTesting Kumarhera to Phandpuri...');
  const paths3 = findPathsDFS('Kumarhera', 'Phandpuri');
  console.log(`Found ${paths3.length} paths`);
  paths3.forEach((p, i) => {
    console.log(`Path ${i + 1}: ${p.legs.map(l => l.routeName).join(' -> ')}`);
    console.log(`Stops: ${p.legs[0].stops.map(s => s.name).join(' -> ')}`);
  });
}

test().catch(console.error);
