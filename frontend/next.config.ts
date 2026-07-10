import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` emits a plain HTML/CSS/JS site into `out/`,
  // which Netlify serves as static files. Every page is a client component that
  // polls the API at runtime, so there is no server-side rendering to host.
  output: "export",
  // next/image can't optimise images without a server, so serve them as-is.
  images: { unoptimized: true },

  // Let phones on the LAN load dev assets (JS chunks, HMR). Without this, Next 16
  // blocks its dev resources from any origin other than localhost, so devices
  // hitting the app by LAN IP get a white screen. The wildcard keeps it working
  // if DHCP reassigns a different 192.168.1.x address.
  allowedDevOrigins: ["192.168.1.118", "192.168.1.*"],
};

export default nextConfig;
