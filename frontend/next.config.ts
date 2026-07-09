import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let phones on the LAN load dev assets (JS chunks, HMR). Without this, Next 16
  // blocks its dev resources from any origin other than localhost, so devices
  // hitting the app by LAN IP get a white screen. The wildcard keeps it working
  // if DHCP reassigns a different 192.168.1.x address.
  allowedDevOrigins: ["192.168.1.118", "192.168.1.*"],
};

export default nextConfig;
