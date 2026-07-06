import fetch from 'node-fetch';

async function check() {
  const res = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
  const data = await res.json();
  const bus = data.find((b: any) => b.RegNo === 'UP78JN1353' || b.regNum === 'UP78JN1353' || b.registration_no === 'UP78JN1353');
  console.log(bus);
}
check();
