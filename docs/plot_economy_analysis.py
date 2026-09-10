"""Optional plot: python3 docs/plot_economy_analysis.py (requires matplotlib/numpy)."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm
import numpy as np

ROOT = Path(__file__).resolve().parent
r = json.loads((ROOT / 'data/economy_analysis.json').read_text())
fig, (ax, bx) = plt.subplots(1, 2, figsize=(13, 4.9), gridspec_kw={'width_ratios': [1, 1.55]})
fig.patch.set_facecolor('#faf8f3')
for a in (ax, bx):
    a.set_facecolor('#faf8f3')
    a.spines['top'].set_visible(False)
    a.spines['right'].set_visible(False)
yields = [450, 600, 750, 900, 1100]
retentions = [.75, .85, .94]
lookup = {(x['grain_kg_ha'], x['storage_retention']): x['food_ratio'] for x in r['sensitivity']}
values = np.array([[lookup[(y, s)] for s in retentions] for y in yields])
ax.imshow(values, cmap='RdYlGn', norm=TwoSlopeNorm(vmin=.55, vcenter=1, vmax=1.65), aspect='auto')
ax.set_xticks(range(3)); ax.set_xticklabels(['75%', '85%', '94%'])
ax.set_yticks(range(5)); ax.set_yticklabels(yields)
for i in range(5):
    for j in range(3):
        ax.text(j, i, f'{values[i,j]:.2f}', ha='center', va='center', fontsize=12, color='#17201a')
ax.set_title('Annual food / annual demand', loc='left', weight='bold', pad=16)
ax.set_xlabel('Retention after 180 days')
ax.set_ylabel('Gross cereal yield (kg / ha)')
for name, label, color in [
    ('normal_good_storage', 'Normal harvest, good storage', '#287d65'),
    ('normal_poor_storage', 'Normal harvest, poor storage', '#a97622'),
    ('one_bad_harvest_60d_reserve', 'One severe harvest shock, good storage', '#b24b50'),
]:
    trace = r['scenarios'][name]['trace']
    bx.plot([v['elapsed_day']/365 for v in trace], [v['stock_fd']/r['adult_equivalents'] for v in trace],
            label=label, color=color, linewidth=1.7)
bx.set_title('Seasonal stored food: five years', loc='left', weight='bold', pad=16)
bx.set_xlabel('Elapsed ecological years')
bx.set_ylabel('Stored energy / daily population demand (days)')
bx.set_ylim(bottom=-8)
bx.set_xlim(0, 5)
bx.axhline(0, color='#333333', linewidth=.8)
bx.grid(alpha=.18)
bx.legend(loc='upper right', fontsize=8, framealpha=.9)
fig.suptitle('48-person reference economy | model assumptions, not historical estimates', x=.08, ha='left', fontsize=13)
fig.text(.08, .025, 'Right: starts after harvest with 60 days of extra reserves; fixed population; 30-day stock samples. Source: economy_analysis.py', fontsize=8, color='#555555')
fig.tight_layout(rect=[0, .06, 1, .93])
fig.savefig(ROOT / 'figures/economy-balance.png', dpi=160, facecolor=fig.get_facecolor())
fig.savefig(ROOT / 'figures/economy-balance.svg', facecolor=fig.get_facecolor())
plt.close(fig)
print('Wrote docs/figures/economy-balance.png and .svg')
