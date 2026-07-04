import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://13.61.187.15:5000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
