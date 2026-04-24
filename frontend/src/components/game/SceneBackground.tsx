/** Ken-burns image stack: default bg + optional turn image crossfade + gradient overlay. */
export const SceneBackground = ({ imageUrl, defaultImageUrl }: { imageUrl: string | null; defaultImageUrl: string }) => (
  <>
    <img src={defaultImageUrl} className="absolute inset-0 w-full h-full object-cover opacity-20 animate-ken-burns" alt="" />
    {imageUrl && (
      <img
        key={imageUrl}
        src={imageUrl}
        className="absolute inset-0 w-full h-full object-cover animate-ken-burns animate-in fade-in duration-1000"
        alt=""
      />
    )}
    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent pointer-events-none" />
  </>
);
