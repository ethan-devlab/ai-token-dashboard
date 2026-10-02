const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const family = (model) => /^[^0-9]*/.exec(model)[0];

export function pricingEntries(rates = {}, search = '') {
  const query = String(search).trim().toLowerCase();
  return Object.entries(rates).filter(([model]) => model.toLowerCase().includes(query))
    .sort(([left], [right]) => names.compare(family(left), family(right)) || names.compare(right, left));
}
