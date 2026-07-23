import { startIngestion } from './src/ingestion/adapter_live';
import { buildGraph } from './src/engine/graph';

async function testIngest() {
  console.log('Building graph...');
  await buildGraph();
  console.log('Starting ingestion...');
  startIngestion();
}

testIngest().catch(err => {
  console.error('Ingestion test failed:', err);
});
