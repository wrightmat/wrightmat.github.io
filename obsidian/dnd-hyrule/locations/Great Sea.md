#location [[Faron Region]]

The Great Sea is the larger sea that surrounds the continent that the Kingdom of Hyrule sits on. Both the Faron Sea and the Necluda Sea transition into the Great Sea, but at which point one becomes the other is unclear. The players will not fully explore the Great Sea in this campaign, but an area or two may be accessible to allude to the larger world outside of the continent.

### Locations

- Faron Sea
- Necluda Sea
- Seabed City

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### No Foraging

##### Fishing

| d6  | Collectible      | Qty (6) |
| --- | ---------------- | ------- |
| 1   | Armored Carp     | 1       |
| 2   | Mighty Porgy     | 1       |
| 3   | Hyrule Bass      | 1       |
| 4   | Stealthfin Trout | 1       |
| 5   | Hearty Salmon    | 1       |
| 6   | Staminoka Bass   | 1       |
^great-sea-fishing
