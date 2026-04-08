import type { Character } from '../../types';

interface InventoryProps {
  character: Character | null;
}

export const Inventory = ({ character }: InventoryProps) => (
  <div className="bg-slate-900 p-8 rounded-[40px] border border-slate-800 shadow-2xl">
    <h3 className="text-xl font-bold mb-4">Treasure & Gear</h3>
    <div className="grid grid-cols-2 gap-4">
      {(character?.inventory || []).map((item: {name: string, description: string}, i: number) => (
        <div key={i} className="p-4 bg-slate-800 rounded-xl" title={item.description}>
          <p className="font-bold">{item.name}</p>
        </div>
      ))}
      {(character?.inventory.length === 0) && <p className="text-slate-600">Empty pockets...</p>}
    </div>
  </div>
);
