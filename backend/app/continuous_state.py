"""Apply metadata and sparse letter updates, including historical full-manor events."""
def merge_meta(world, patch):
    previous = (world.get('manor') or {}).get('letters')
    world.update(patch['meta'])
    manor = world.get('manor')
    if manor is None:
        return
    manor = world['manor'] = dict(manor)
    if 'manor' in patch['meta'] and 'letters' not in patch['meta']['manor'] and previous is not None:
        manor['letters'] = previous
    if patch.get('mail'):
        changed = {letter['id']: letter for letter in patch['mail']}
        manor['letters'] = [changed.pop(letter['id'], letter) for letter in manor.get('letters', [])] + list(changed.values())
