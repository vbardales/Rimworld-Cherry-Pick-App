// La cle telle que Cherry Picker la fabrique — verifie dans son assembly, dans
// DefUtility.ToKey :
//
//   TypeName/defName              pour les types de Verse et RimWorld
//   TypeName/defName/Namespace    pour tous les autres
//
// Le troisieme segment n'est pas decoratif : c'est par lui que Cherry Picker
// retrouve l'assemblage. Une def d'un mod tiers — ItemProcessor.ItemAcceptedDef —
// ne se retire pas sans lui.
export function keyOf(defType: string, defName: string | null): string | null {
  if (!defName) return null;      // une base abstraite ne se retire pas
  const dot = defType.lastIndexOf(".");
  return dot < 0
    ? `${defType}/${defName}`
    : `${defType.slice(dot + 1)}/${defName}/${defType.slice(0, dot)}`;
}
