export interface Recipe {
  name: string
  instructions: string
}

export interface NewRecipe {
  name: string
  instructions: string
}

export interface RecipeRolled {
  recipe: Recipe | null
}

export interface AddRecipeMessage {
  AddRecipe: Recipe
}

export interface RollRecipeMessage {
  RollRecipe: true
}

export interface DeleteRecipeMessage {
  DeleteRecipe: {
    index: number
  }
}

export interface GetRecipesMessage {
  GetRecipes: true
}

// List of recipes
export type Recipes = Recipe[]
