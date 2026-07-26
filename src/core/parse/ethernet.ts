import { formatMac } from '../utils';

const ETHER_TYPE_ARP = 0x0806;
const ETHER_TYPE_IPV4 = 0x0800;

export type EthernetFrame = {
  dstMac: string;
  srcMac: string;
  etherType: number;
  payload: Uint8Array;
};

export function parseEthernet(packet: Uint8Array): EthernetFrame | null {
  if (packet.length < 14) return null;
  return {
    dstMac: formatMac(packet, 0),
    srcMac: formatMac(packet, 6),
    etherType: (packet[12] << 8) | packet[13],
    payload: packet.subarray(14),
  };
}

export function etherTypeLabel(etherType: number): 'ARP' | 'IPv4' | 'OTHER' {
  if (etherType === ETHER_TYPE_ARP) return 'ARP';
  if (etherType === ETHER_TYPE_IPV4) return 'IPv4';
  return 'OTHER';
}

export { ETHER_TYPE_ARP, ETHER_TYPE_IPV4 };
