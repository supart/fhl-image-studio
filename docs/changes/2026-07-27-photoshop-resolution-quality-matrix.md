# 2026-07-27 Photoshop Resolution And Quality Matrix

## Scope

Record serial real-task acceptance across resolution, quality and selection
variants while the isolated hardened candidate's public Bridge Profile was
ready. Do not retain sensitive request or session content.

## Accepted Matrix

- `ps-227...`: `Auto / 1K / low`, edge selection, completed and written back
  by the Photoshop plugin.
- `ps-fac...`: manual `16:9 / 2K / high`, completed and written back by the
  Photoshop plugin.
- `ps-4d6...`: `Auto`, effective `4:5`, `4K / auto`, full image, completed and
  written back by the Photoshop plugin.

All three real tasks ran serially while public Bridge health reported
`profileReady=true`.

## 4K Size Evidence

- The shared size matrix defines the `4:5 / 4K` contract canvas as
  `3072x3840`.
- The PNG returned by `gpt-image-2` was actually `2576x3216` pixels. This is
  recorded as the upstream response size; it must not be described as actual
  4K pixel output.

## Final State And Privacy

- Temporary Bridge task directories were removed after each task settled.
- Photoshop was closed with no document waiting to be saved.
- Desktop production code did not change in this batch.
- This record contains no complete prompt, response, API key or session data.
