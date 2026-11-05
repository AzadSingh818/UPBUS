import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.31.203', 'localhost', '127.0.0.1'],
  transpilePackages: ['lucide-react'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    const backendBase = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' 
      ? 'http://127.0.0.1:5000' 
      : 'http://65.2.150.27:5000');
      
    return [
      {
        source: '/api/:path*',
        destination: `${backendBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
