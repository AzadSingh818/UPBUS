import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.31.203', 'localhost', '127.0.0.1'],
  transpilePackages: ['lucide-react'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    // When running locally, proxy to local backend. On Vercel, proxy to AWS backend.
    const destination = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:5000/api/:path*' 
      : 'http://51.20.190.81:5000/api/:path*';
      
    return [
      {
        source: '/api/:path*',
        destination,
      },
    ];
  },
};

export default nextConfig;
