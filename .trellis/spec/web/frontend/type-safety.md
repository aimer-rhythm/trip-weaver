# Type Safety

> Web-specific type safety patterns for apps/web.

## Overview

See shared spec for general type safety conventions. Web-specific details:

## API Type Flow

`
Server TypeBox schema (packages/shared)
  -> Static<typeof Schema> generates TypeScript type
  -> API returns typed JSON
  -> React Query useQuery<SomeType> receives typed data
  -> Components consume typed props
`

## Error Type Discrimination

`	s
// ApiError carries status + data for frontend branching
if (error instanceof ApiError) {
  if (error.status === 429) {
    const resetAt = error.data?.resetAt as number | undefined;
    // show quota error with reset time
  } else if (error.status === 400 && error.data?.code === 'no_llm') {
    // show LLM config error with appropriate message
  }
}
`

## Query Key Type Safety

`	s
// keys is s const for literal type inference
export const keys = {
  me: ['me'] as const,
  trip: (id: string) => ['trips', id] as const,
};
// queryClient.invalidateQueries({ queryKey: keys.trip(id }) })
`

## Common Patterns

- Component props: interface Props pattern (not 	ype Props)
- Event handlers typed explicitly: onChange={(e: FormEvent) => ...}
- ReactNode for children: { children: ReactNode }
- State discriminated by union: 	ype SaveState = 'idle' | 'saving' | 'saved' | 'error'
- Template literals for CSS classes: ` className={gen-phase } `

