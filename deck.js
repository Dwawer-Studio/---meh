class Card {
    constructor(color, name, type, emoji, svgFile, options = {}) {
        this.color = color;
        this.name = name;
        this.type = type;
        this.emoji = emoji;
        this.svgFile = svgFile;
        this.definitionId = options.definitionId || type;
        this.id = typeof options.idFactory === 'function'
            ? options.idFactory()
            : Math.random().toString(36).slice(2, 11);
    }
    isPlayable(topCard, activeColor) {
        if (this.color === 'black') return true;
        if (this.color === activeColor) return true;
        if (this.name === topCard.name) return true;
        return false;
    }
}

class Deck {
    constructor(options = {}) {
        this.cards = [];
        this.random = typeof options.random === 'function' ? options.random : Math.random;
        this.recipeId = options.recipeId || MEH_CATALOG_MANIFEST.activeRecipeId;
        this._idFactory = typeof options.idFactory === 'function' ? options.idFactory : null;
        this._cardSequence = 0;
        this.buildDeck(this.recipeId);
        this.shuffle();
    }
    _nextCardId(definitionId, color) {
        const sequence = this._cardSequence++;
        if (this._idFactory) return this._idFactory({ definitionId, color, sequence });
        const entropy = Math.floor(this.random() * 0x1000000).toString(36).padStart(5, '0');
        return `c${sequence.toString(36)}${entropy}`;
    }
    _createCard(definition, color) {
        const imageFile = `assets/cards/${color}-${definition.assetBase}.webp`;
        return new Card(
            color,
            definition.nameAr,
            definition.type,
            definition.emoji,
            imageFile,
            {
                definitionId: definition.definitionId,
                idFactory: () => this._nextCardId(definition.definitionId, color),
            },
        );
    }
    buildDeck(recipeId) {
        const definitions = new Map(MEH_CATALOG_MANIFEST.definitions.map(def => [def.definitionId, def]));
        const recipe = MEH_CATALOG_MANIFEST.recipes.find(item => item.recipeId === recipeId);
        if (!recipe) throw new Error(`Unknown deck recipe: ${recipeId}`);

        for (const color of MEH_CORE_MANIFEST.standardColors) {
            for (const definitionId of recipe.coloredDefinitionIds) {
                const definition = definitions.get(definitionId);
                if (!definition) throw new Error(`Unknown card definition: ${definitionId}`);
                this.cards.push(this._createCard(definition, color));
            }
        }
        for (const definitionId of recipe.blackDefinitionIds) {
            const definition = definitions.get(definitionId);
            if (!definition) throw new Error(`Unknown card definition: ${definitionId}`);
            this.cards.push(this._createCard(definition, MEH_CORE_MANIFEST.wildColor));
        }
        if (this.cards.length !== MEH_CORE_MANIFEST.deckSize) {
            throw new Error(`Deck recipe ${recipeId} produced ${this.cards.length} cards`);
        }
    }
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
    draw() {
        return this.cards.length > 0 ? this.cards.pop() : null;
    }
}
