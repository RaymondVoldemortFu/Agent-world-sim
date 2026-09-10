"""Reproducible design calculations, not the simulation engine.
Run: python3 docs/economy_analysis.py
All quantities and assumptions are documented in PREHISTORIC_ECONOMY_DESIGN.md.
"""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
P = {
    'seed': 20260910, 'days': 365, 'kcal_per_food_day': 2500,
    'population': 48, 'workers': 32, 'children': 8, 'elders': 8,
    'child_food_equivalent': 0.6, 'elder_food_equivalent': 0.85,
    'productive_ap_per_worker_day': 3.5,
    'grain': {'area_ha': 20, 'yield_kg_ha': 750, 'seed_kg_ha': 120,
              'field_retention': 0.92, 'milling_retention': 0.96, 'kcal_kg': 3400},
    'pulse': {'area_ha': 4, 'yield_kg_ha': 500, 'seed_kg_ha': 100,
              'field_retention': 0.90, 'milling_retention': 0.95, 'kcal_kg': 3300},
    'fallow_ha': 12, 'reference_storage_age_days': 180,
    'storage_retention_180_days': 0.94,
    'wild_supplement_fd_year': 1800, 'animal_supplement_fd_year': 180,
    'harvest_window_days': 20, 'harvest_ap_ha_novice': 90,
    'harvest_ap_ha_practiced': 67.5, 'essential_nonharvest_ap_day': 40,
    'ore_kg_batch': 10, 'ore_fe_fraction': 0.45, 'iron_recovery': 0.40,
    'refining_retention': 0.80, 'finishing_retention': 0.90,
    'charcoal_kg_batch': 20, 'charcoal_yield_dry_wood': 0.25,
    'stone_axe_supply_ap': 5, 'iron_axe_supply_ap': 22.5,
    'stone_axe_wood_kg_ap': 20, 'iron_axe_wood_kg_ap': 35,
}


def edible(crop, weather=1.0, harvest_fraction=1.0):
    # Seed is reserved from recovered grain; storage losses are applied separately.
    return (max(0, crop['yield_kg_ha'] * weather * harvest_fraction * crop['field_retention']
                - crop['seed_kg_ha']) * crop['area_ha'] * crop['milling_retention']
            * crop['kcal_kg'] / P['kcal_per_food_day'])


AE = P['workers'] + P['children'] * P['child_food_equivalent'] + P['elders'] * P['elder_food_equivalent']
DEMAND = AE * P['days']
BASE_HARVEST = edible(P['grain']) + edible(P['pulse'])


def season(day):
    # Spring 60..151, summer 152..243, autumn 244..334; remaining days winter.
    return 0 if 60 <= day <= 151 else 1 if 152 <= day <= 243 else 2 if 244 <= day <= 334 else 3


def simulate(retention=0.94, reserve_days=60, years=5, weather=None, harvest_fraction=1.0):
    """Starts just after harvest. Fixed population, one fungible energy stock.
    Crop storage losses are daily, not duplicated by the static annual formula.
    Seed for the next crop is protected separately; fresh supplements are eaten first.
    This is an energy-feasibility envelope, not an agent behaviour/mortality simulation.
    """
    weather = weather or [1.0] * years
    daily_decay = 1 - retention ** (1 / P['reference_storage_age_days'])
    cap = BASE_HARVEST + reserve_days * AE
    stock = cap
    deficit = 0.0
    shortage_days = 0
    spoiled = overflow = 0.0
    min_stock = stock
    trace = []
    shares = [0.18, 0.32, 0.38, 0.12]
    lengths = [92, 92, 91, 90]
    for step in range(years * 365):
        day = (215 + step) % 365 + 1
        year = step // 365
        factor = weather[year]
        # Deposit next harvest at day 215; aggregate pulses with cereal for this envelope.
        if day == 215:
            incoming = edible(P['grain'], factor, harvest_fraction) + edible(P['pulse'], 0.6 * factor + 0.4)
            overflow += max(0, stock + incoming - cap)
            stock = min(cap, stock + incoming)
        loss = stock * daily_decay
        stock -= loss
        spoiled += loss
        s = season(day)
        fresh = (P['wild_supplement_fd_year'] * shares[s] / lengths[s] * max(0.4, min(1.3, 0.5 + 0.5 * factor))
                 + P['animal_supplement_fd_year'] / 365)
        need = max(0, AE - fresh)
        missed = max(0, need - stock)
        deficit += missed
        shortage_days += missed > 1e-8
        stock = max(0, stock - need)
        min_stock = min(min_stock, stock)
        if step % 30 == 0 or step == years * 365 - 1:
            trace.append({'elapsed_day': step + 1, 'calendar_day': day, 'stock_fd': round(stock, 2)})
    return {'deficit_fd': round(deficit, 2), 'shortage_days': shortage_days,
            'min_stock_fd': round(min_stock, 2), 'end_stock_fd': round(stock, 2),
            'storage_loss_fd': round(spoiled, 2), 'overflow_fd': round(overflow, 2), 'trace': trace}


def calculate():
    grain = edible(P['grain']) * 0.94
    pulse = edible(P['pulse']) * 0.93  # Static reference age/handling differs slightly for pulses.
    supply = grain + pulse + P['wild_supplement_fd_year'] + P['animal_supplement_fd_year']
    balanced_supply = edible(dict(P['grain'], area_ha=22)) * .94 + edible(dict(P['pulse'], area_ha=6)) * .93 + 1980
    harvest_capacity = (P['workers'] * P['productive_ap_per_worker_day'] - P['essential_nonharvest_ap_day']) * P['harvest_window_days']
    harvest_demand = {k: P['grain']['area_ha'] * P['harvest_ap_ha_' + k] for k in ['novice', 'practiced']}
    fractions = {k: min(1, harvest_capacity / v) for k, v in harvest_demand.items()}
    sensitivity = []
    for yield_kg in [450, 600, 750, 900, 1100]:
        for retained in [0.75, 0.85, 0.94]:
            crop = dict(P['grain'], yield_kg_ha=yield_kg)
            total = edible(crop) * retained + pulse + 1980
            sensitivity.append({'grain_kg_ha': yield_kg, 'storage_retention': retained,
                                'annual_food_fd': round(total, 2), 'food_ratio': round(total / DEMAND, 4)})
    scenarios = {}
    for label, args in {
        'normal_good_storage': {},
        'normal_poor_storage': {'retention': 0.75},
        'one_bad_harvest_60d_reserve': {'weather': [1, 0.55, 1, 1, 1]},
        'two_bad_harvests_60d_reserve': {'weather': [1, 0.55, 0.65, 1, 1]},
        'one_bad_harvest_0d_reserve': {'reserve_days': 0, 'weather': [1, 0.55, 1, 1, 1]},
        'novice_harvest_bottleneck': {'harvest_fraction': fractions['novice']},
    }.items():
        scenarios[label] = simulate(**args)
    monte_carlo = []
    weather_paths = []
    rng = random.Random(P['seed'])
    for _ in range(1000):
        weather_paths.append([rng.lognormvariate(-0.5 * 0.2 ** 2, 0.2) for _ in range(5)])
    for retention in [0.75, 0.94]:
        for reserve in [0, 30, 60, 90]:
            runs = [simulate(retention=retention, reserve_days=reserve, weather=path) for path in weather_paths]
            monte_carlo.append({'retention_180d': retention, 'reserve_days': reserve,
                                'paths': 1000, 'years_per_path': 5,
                                'fraction_with_shortage': sum(r['shortage_days'] > 0 for r in runs) / len(runs),
                                'mean_deficit_fd': round(sum(r['deficit_fd'] for r in runs) / len(runs), 2)})
    geology = {'recovered_iron_kg': P['ore_kg_batch'] * P['ore_fe_fraction'] * P['iron_recovery']}
    geology['bar_kg'] = geology['recovered_iron_kg'] * P['refining_retention']
    geology['finished_metal_kg'] = geology['bar_kg'] * P['finishing_retention']
    geology['dry_wood_kg'] = P['charcoal_kg_batch'] / P['charcoal_yield_dry_wood']
    break_even = (P['iron_axe_supply_ap'] - P['stone_axe_supply_ap']) / (1 / P['stone_axe_wood_kg_ap'] - 1 / P['iron_axe_wood_kg_ap'])
    return {
        'assumptions': P, 'adult_equivalents': AE, 'annual_demand_fd': DEMAND,
        'static_food': {'grain_fd': grain, 'pulse_fd': pulse, 'total_fd': supply,
                        'surplus_fd': supply - DEMAND, 'food_ratio': supply / DEMAND,
                        'grain_before_storage_fd': edible(P['grain']),
                        'pulse_before_storage_fd': edible(P['pulse'])},
        'balanced_preset': {'grain_ha': 22, 'pulse_ha': 6, 'fallow_ha': 14,
                            'annual_food_fd': balanced_supply, 'food_ratio': balanced_supply / DEMAND,
                            'food_ratio_with_15pct_extra_demand': balanced_supply / (DEMAND * 1.15),
                            'harvest_capacity_26days_ap': (32 * 3.5 - 40) * 26,
                            'practiced_grain_harvest_ap': 22 * 67.5},
        'wild_food_ceiling': {'plants_fd': 7500, 'fish_fd': 6000 * .55 * 1100 / 2500,
                             'game_fd': 750 * 1600 / 2500,
                             'accessible_retained_fd': (7500 + 1452 + 480) * .82 * .9,
                             'supported_adult_equivalents': (7500 + 1452 + 480) * .82 * .9 / 365},
        'harvest': {'capacity_ap': harvest_capacity, 'required_ap': harvest_demand,
                    'harvested_fraction': fractions},
        'sensitivity': sensitivity, 'scenarios': scenarios, 'monte_carlo': monte_carlo,
        'iron': geology, 'axe_break_even_wood_kg': break_even,
        'nitrogen_budget_kg_year': {'cereal_exports': 20 * (750 * .018 + 900 * .4 * .005),
                                  'pulse_net_input': 4 * (35 - 500 * .035),
                                  'fallow_input': 12 * 8, 'manure_transfer': 80,
                                  'deposition': 36 * 1.5},
        'pottery_batch': {'single_person_ap_for_12_pots': 12 * (3 + 1),
                          'shared_batch_ap_for_12_pots': 3 + 12 * .65,
                          'single_dry_wood_kg': 12 * 12, 'shared_dry_wood_kg': 24},
    }


if __name__ == '__main__':
    result = calculate()
    assert result['iron']['finished_metal_kg'] <= P['ore_kg_batch'] * P['ore_fe_fraction']
    assert result['scenarios']['normal_good_storage']['deficit_fd'] == 0
    output = ROOT / 'data/economy_analysis.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ['assumptions', 'scenarios', 'sensitivity']}, ensure_ascii=False, indent=2))
    print('SCENARIOS', json.dumps({k: {x:y for x,y in v.items() if x != 'trace'} for k,v in result['scenarios'].items()},ensure_ascii=False))
    print('Wrote', output)
