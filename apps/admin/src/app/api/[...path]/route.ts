import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendBase = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' 
    ? 'http://127.0.0.1:5000' 
    : 'http://65.2.150.27:5000');
    
  const targetUrl = `${backendBase}/api/${path.join('/')}${req.nextUrl.search}`;

  try {
    const res = await fetch(targetUrl, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Gracefully handle backend offline state without throwing terminal proxy errors
    return NextResponse.json({ success: false, offline: true, logs: [], buses: [], stats: null, removedRoutes: [] }, { status: 200 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const backendBase = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' 
    ? 'http://127.0.0.1:5000' 
    : 'http://65.2.150.27:5000');

  const targetUrl = `${backendBase}/api/${path.join('/')}`;

  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, offline: true }, { status: 200 });
  }
}
