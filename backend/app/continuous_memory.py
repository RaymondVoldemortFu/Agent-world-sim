"""Append deterministic personal outcomes without losing them to an in-flight model save."""
def merge_system_memory(context, memories):
    known = context.setdefault('systemMemory', [])
    for memory in memories:
        if memory not in known:
            context['tail'].append({'role': 'user', 'content': '系统行动记忆：'+memory})
            known.append(memory)
    return context
