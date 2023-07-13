#location [[Necluda Region]]

The Necluda Sea is located at the southeast end of Hyrule where it completely surrounds Tenoko Island and Eventide Island. The Necluda Sea borders the Lanayru Sea to the north and the Faron Sea to the west. It extends through much of the south coast, as far west as Martha's Landing.

Throughout the sea, carp and porgies are abundant. Additionally, enemy Water Octoroks and Blue Lizalfos can be found inhabiting the area.

### Locations

 * [[Eventide Island]]
 * Tenoko Island

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible   | Qty (12) |
| ---- | ------------- | -------- |
| 1-2  | Apple         | 2        |
| 3-5  | Hearty Durian | 3        |
| 6-8  | Palm Fruit    | 3        |
| 9-11 | Hydromelon    | 3        |
| 12   | Fairy         | 1        |
^necluda-sea-foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-3 | Hyrule Bass  | 3       |
| 4-6 | Mighty Porgy | 3       |
^necluda-sea-fishing
