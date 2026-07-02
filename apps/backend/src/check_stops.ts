import { mockDb } from './db';

const ambehtaStops = mockDb.stops.filter((s: any) => s.name.toLowerCase().includes('ambehta'));
const phandpuriStops = mockDb.stops.filter((s: any) => s.name.toLowerCase().includes('phandpuri'));

console.log('Ambehta stops in DB:', ambehtaStops);
console.log('Phandpuri stops in DB:', phandpuriStops);
