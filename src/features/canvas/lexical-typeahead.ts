import { $createTextNode, $insertNodes, type LexicalNode } from 'lexical';

export function $replaceTypeaheadQuery(
  queryNode: LexicalNode | null,
  replacementNode: LexicalNode,
): void {
  if (queryNode) queryNode.replace(replacementNode);
  else $insertNodes([replacementNode]);
  const trailingSpace = $createTextNode(' ');
  replacementNode.insertAfter(trailingSpace);
  trailingSpace.selectEnd();
}
