import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://51.20.190.81:5000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
