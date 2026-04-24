interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}

export const RangeSlider = ({ label, value, min, max, step, displayValue, onChange }: RangeSliderProps) => (
  <div className="flex flex-col gap-2 p-5 bg-black/40 rounded-[20px] border-2 border-slate-800">
    <div className="flex justify-between items-center">
      <span className="font-black uppercase tracking-tighter text-white">{label}</span>
      <span className="text-sm text-slate-400">{displayValue}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-600"
    />
  </div>
);
