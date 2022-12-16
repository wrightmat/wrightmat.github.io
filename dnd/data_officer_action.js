data_officer_action = [
    {
        title: "Augment Weapon",
        icon: "blaster",
        subtitle: "Increase critical hit range",
        description: "Critical hit occurs on an 18 to 20 for a single weapon",
        bullets: [
            "You spend your action augmenting a particular weapon, possibly by overdrawing a ballista or overloading an energy weapon. This increases the critical hit range of the weapon by 2, so a critical hit now occurs on 18 to 20."
        ]
    },
    {
        title: "Brace For Impact",
        icon: "bolt-shield",
        subtitle: "Damage reduced from crashing/ramming",
        description: "Damage reduced by 2d10 from crashing or ramming",
        bullets: [
            "As an action, you prepare the ship for an immediate impact. Until the start of your next turn, any damage that the ship takes from crashing or ramming is reduced by 2d10."
        ]
    },
    {
        title: "Emergency Repairs",
        icon: "caged-ball",
        subtitle: "Gain temporary hit points",
        description: "Gain temporary hit points",
        bullets: [
		"As an action, you quickly make repairs to the ship using whatever materials are available. The repairs may not hold long term, but they’ll do for now. The ship gains 2d10 temporary hit points."
        ]
    },
    {
        title: "Expend Spell Slot",
        icon: "beam-wake",
        subtitle: "Infuse the ship with magic",
        description: "Infuse the ship with magic to increase its stats",
        bullets: [
            "As an action, you expend a spell slot to infuse the ship with your magic, choosing one of the following effects:",
            " • Shields Up. Until the start of its next turn, the ship gains a bonus to its AC equal to 3 + 1 per spell level above first.",
            " • Thrusters. Until the start of its next turn, the ship gains a bonus to its movement equal to 30 + 15 per spell level above first.",
	    "At the end of this action, you must roll a d20. If the number rolled falls at or below the number of the spell slot used, the ship suffers a Critical Effect."
        ]
    },
    {
        title: "Full Speed Ahead",
        icon: "clout",
        subtitle: "Increase the ship's speed",
        description: "Movement speed increased by 1d6 x 5",
        bullets: [
            "As an action, you exhort the crew to work harder and drive the ship forward faster. Roll a d6 and multiply the result by 5. Apply the total as a bonus to the ship’s speed until the end of the ship’s next turn.",
            "If the ship is already benefiting from this action’s bonus, don’t add the bonuses together; the higher bonus applies."
        ]
    },
    {
        title: "Motivate Crew",
        icon: "cheerful",
        subtitle: "Add extra die to d20 Test",
        description: "Add an extra d8 to an ability check, attack roll, or saving throw",
        bullets: [
            "As an action, you attempt to motivate the crew, helping them achieve their best. You gain a motivation die, which is a d8. Before the start of your next turn, you can roll the die and add the number rolled to one ability check, attack roll, or saving throw that the ship or crew makes. You can decide to use the motivation die after the d20 is rolled, but before the outcome is determined.",
            "Once rolled, the motivation die is lost. You can only have one motivation die at a time, and only one motivation die can be applied to any roll.",
        ]
    },
    {
        title: "Repair Critical Effect",
        icon: "atomic-slashes",
        subtitle: "Reverse the effect of a critial hit",
        description: "Reverse the effect of a critial hit",
        bullets: [
            "As an action, you can reverse the effect of a critical hit. This requires succeeding at a DC 20 Intelligence (Investigation) check. You gain advantage on this roll if you have access to appropriate artisans’ tools (Carpenter’s Tools, Mason’s Tools, Tinker’s Tools, etc.) and proficiency with them.",
	    "If successful, the effect ends (so a fire is put out, helm power is restored, a weapon is restored, etc.).",
	    "If the ship or weapon suffers a critical hit twice, the damage is so severe that it cannot be repaired until the combat ends."
        ]
    },
    {
        title: "Take Aim",
        icon: "arrow-cluster",
        subtitle: "Grant advantage to a weapon",
        description: "Grant advantage to a single weapon attack roll",
        bullets: [
	    "As an action, you direct the crew’s firing, aiding in aiming one of the ship’s weapons. Select one of the ship’s weapons that is within 10 feet of you. It gains advantage on the next attack roll it makes before the end of the ship’s next turn."
        ]
    },
    {
        title: "Tend to Crew Injuries",
        icon: "bandage-roll",
        subtitle: "Restore some quantity of crew",
        description: "Restore some quantity of crew",
        bullets: [
            "As an action, you tend to the most serious injuries of the crew. Roll a d4. A number of crew members previously thought dead equal to the die roll regain consciousness with 4 hit points."
        ]
    },
    {
        title: "Tend to Officer Injuries",
        icon: "internal-injury",
        subtitle: "Grant temporary hit points or stabilize",
        description: "Grant temporary hit points or stabilize a single player",
        bullets: [
            "As an action, you hastily tend to the injuries of another officer within 5 feet of you. The bandages may not hold up in the long term, but they will help for now. If the officer is at 0 hit points, they become stable. Otherwise, the officer gains temporary hit points equal to 1d6 + your Wisdom modifier."
        ]
    }
]