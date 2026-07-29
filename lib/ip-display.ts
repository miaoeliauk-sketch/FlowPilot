type IPDisplayItem = {
  id: string;
  name: string;
};

function getUniqueIDSuffix(ip: IPDisplayItem, sameNameIPs: IPDisplayItem[]): string {
  const maxLength = Math.max(...sameNameIPs.map(item => item.id.length), 6);
  for (let length = 6; length <= maxLength; length += 1) {
    const suffix = ip.id.slice(-length);
    if (sameNameIPs.every(item => item.id === ip.id || item.id.slice(-length) !== suffix)) {
      return suffix;
    }
  }
  return ip.id;
}

export function getIPDisplayLabel(ip: IPDisplayItem, ips: IPDisplayItem[]): string {
  const normalizedName = ip.name.trim();
  const sameNameIPs = ips.filter(item => item.name.trim() === normalizedName);
  if (!normalizedName || sameNameIPs.length < 2) {
    return ip.name;
  }
  return `${ip.name} · #${getUniqueIDSuffix(ip, sameNameIPs)}`;
}
