interface D20Props {
  roll: number;
  success: boolean;
  size?: number;
}

export const D20 = ({ roll, success, size = 72 }: D20Props) => {
  const isNat20 = roll === 20;
  const isNat1 = roll === 1;
  const color = isNat20 ? '#22c55e' : isNat1 ? '#ef4444' : success ? '#f59e0b' : '#f87171';
  const fontSize = roll >= 10 ? (22 * size) / 72 : (27 * size) / 72;

  return (
    <svg viewBox="0 0 100 112" width={size} height={size * 1.125} fill="none">
      <polygon points="50,4 95,30 95,82 50,108 5,82 5,30" stroke={color} strokeWidth="2.5" fill={`${color}18`} />
      <line x1="5" y1="30" x2="95" y2="30" stroke={color} strokeWidth="1.5" opacity="0.35" />
      <line x1="5" y1="82" x2="95" y2="82" stroke={color} strokeWidth="1.5" opacity="0.35" />
      <line x1="50" y1="4" x2="5" y2="30" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="50" y1="4" x2="95" y2="30" stroke={color} strokeWidth="1" opacity="0.2" />
      <text x="50" y="56" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="900" fill={color} fontFamily="sans-serif">
        {roll}
      </text>
    </svg>
  );
};
