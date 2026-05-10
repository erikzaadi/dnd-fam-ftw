interface SceneBackgroundProps {
  imageUrl: string | null;
  defaultImageUrl: string;
}

/** Ken-burns image stack: default bg + optional turn image crossfade + gradient overlay. */
export const SceneBackground = ({ imageUrl, defaultImageUrl }: SceneBackgroundProps) => (
  <>
    <img src={defaultImageUrl} className="absolute inset-0 w-full h-full object-cover opacity-25 animate-ken-burns" alt="" />
    {imageUrl && (
      <img
        key={imageUrl}
        src={imageUrl}
        className="absolute inset-0 w-full h-full object-cover animate-ken-burns animate-in fade-in duration-1000 opacity-100"
        alt=""
      />
    )}
    <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-slate-950/15 via-transparent to-transparent sm:from-slate-950/85 sm:via-slate-950/15" />
  </>
);
