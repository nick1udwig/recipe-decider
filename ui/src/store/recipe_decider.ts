import { create } from 'zustand'
import { NewRecipe, Recipe, RecipeRolled, Recipes } from '../types/RecipeDecider'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface RecipeDeciderStore {
  recipes: Recipes
  rolledRecipe: Recipe | null
  currentTab: 'roll' | 'input'
  editingRecipe: Recipe | null
  editingRecipeIndex: number | null
  deleteConfirmation: {
    isOpen: boolean;
    recipeIndex: number | null;
  };
  addRecipe: (recipe: NewRecipe) => void
  updateRecipe: (index: number, updatedRecipe: Recipe) => void
  deleteRecipe: (index: number) => void
  setEditingRecipe: (recipe: Recipe | null, index: number | null) => void
  setDeleteConfirmation: (isOpen: boolean, recipeIndex: number | null) => void
  setRolledRecipe: (rolledRecipe: Recipe | null) => void
  setCurrentTab: (tab: 'roll' | 'input') => void
  get: () => RecipeDeciderStore
  set: (partial: RecipeDeciderStore | Partial<RecipeDeciderStore>) => void
}

const useRecipeDeciderStore = create<RecipeDeciderStore>()(
  persist(
    (set, get) => ({
      recipes: [],
      rolledRecipe: null,
      currentTab: 'roll',
      editingRecipe: null,
      editingRecipeIndex: null,
      deleteConfirmation: {
        isOpen: false,
        recipeIndex: null,
      },
      addRecipe: (recipe: NewRecipe) => {
        const { recipes } = get()
        // Make a new array to ensure React recognizes the state change
        const newRecipes = [...recipes, recipe]
        console.log("Adding recipe to store:", recipe)
        console.log("New recipes array:", newRecipes)
        set({ recipes: newRecipes })
      },
      updateRecipe: (index: number, updatedRecipe: Recipe) => {
        const { recipes } = get()
        const newRecipes = [...recipes]
        newRecipes[index] = updatedRecipe
        set({ 
          recipes: newRecipes,
          editingRecipe: null,
          editingRecipeIndex: null 
        })
      },
      deleteRecipe: (index: number) => {
        const { recipes } = get()
        const newRecipes = recipes.filter((_, i) => i !== index)
        set({ recipes: newRecipes })
      },
      setEditingRecipe: (recipe: Recipe | null, index: number | null) => {
        set({ editingRecipe: recipe, editingRecipeIndex: index })
      },
      setDeleteConfirmation: (isOpen: boolean, recipeIndex: number | null) => {
        set({ deleteConfirmation: { isOpen, recipeIndex } })
      },
      setRolledRecipe: (rolledRecipe: Recipe | null) => {
        set({ rolledRecipe })
      },
      setCurrentTab: (tab: 'roll' | 'input') => {
        set({ currentTab: tab })
      },
      get,
      set,
    }),
    {
      name: 'recipe_decider', // unique name
      storage: createJSONStorage(() => sessionStorage), // (optional) by default, 'localStorage' is used
    }
  )
)

export default useRecipeDeciderStore
