export interface Layout {
  name: string
  label: string
  description: string
}

export const layouts: Layout[] = [
  {
    name: 'list',
    label: 'List',
    description: 'Classic single-column list with excerpts',
  },
  {
    name: 'card',
    label: 'Card',
    description: 'Image-forward grid cards',
  },
  {
    name: 'magazine',
    label: 'Magazine',
    description: 'Featured hero card with smaller cards below',
  },
  {
    name: 'compact',
    label: 'Compact',
    description: 'Title-only dense list',
  },
]

export type LayoutName = 'list' | 'card' | 'magazine' | 'compact'

export const LAYOUT_VALUES: readonly LayoutName[] = ['list', 'card', 'magazine', 'compact']
