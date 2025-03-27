import { useState, useEffect, useCallback } from "react";
import HyperwareClientApi from "@hyperware-ai/client-api";
import "./App.css";
import { AddRecipeMessage, DeleteRecipeMessage, Recipe, RollRecipeMessage, UpdateRecipeMessage } from "./types/RecipeDecider";
import useRecipeDeciderStore from "./store/recipe_decider";
import ConfirmationModal from "./components/ConfirmationModal";

const BASE_URL = import.meta.env.BASE_URL;
if (window.our) window.our.process = BASE_URL?.replace("/", "");

const PROXY_TARGET = `${(import.meta.env.VITE_NODE_URL || "http://localhost:8080")}${BASE_URL}`;

// This env also has BASE_URL which should match the process + package name
const WEBSOCKET_URL = import.meta.env.DEV
  ? `${PROXY_TARGET.replace('http', 'ws')}`
  : undefined;

function App() {
  const {
    recipes,
    rolledRecipe,
    currentTab,
    isEditMode,
    editingRecipeIndex,
    addRecipe,
    setRolledRecipe,
    setCurrentTab,
    setEditMode,
    set
  } = useRecipeDeciderStore();

  const [recipeName, setRecipeName] = useState("");
  const [recipeInstructions, setRecipeInstructions] = useState("");
  const [nodeConnected, setNodeConnected] = useState(true);
  const [api, setApi] = useState<HyperwareClientApi | undefined>();

  useEffect(() => {
    // Get recipes using http
    fetch(`${BASE_URL}/recipes`)
      .then((response) => response.json())
      .then((data) => {
        set({ recipes: data?.Recipes || [] });

        // If there are no recipes, open to the input tab, else open to the roll tab
        if (data?.Recipes?.length === 0) {
          setCurrentTab('input');
        } else {
          setCurrentTab('roll');
        }
      })
      .catch((error) => console.error(error));

    // Connect to the Hyperdrive via websocket
    console.log('WEBSOCKET URL', WEBSOCKET_URL)
    if (window.our?.node && window.our?.process) {
      const api = new HyperwareClientApi({
        uri: WEBSOCKET_URL,
        nodeId: window.our.node,
        processId: window.our.process,
        onOpen: (_event, _api) => {
          console.log("Connected to Hyperware");
        },
        onMessage: (json, _api) => {
          console.log('WEBSOCKET MESSAGE', json)
          try {
            const data = JSON.parse(json);
            console.log("WebSocket received message", data);
            const [messageType] = Object.keys(data);
            if (!messageType) return;

            if (messageType === "NewRecipe") {
              console.log("New recipe from WebSocket:", data.NewRecipe);
              addRecipe(data.NewRecipe);
              // Also refresh the recipe list to make sure we have everything
              fetch(`${BASE_URL}/recipes`)
                .then((response) => response.json())
                .then((data) => {
                  console.log("Updated recipes from websocket handler:", data.Recipes);
                  if (data.Recipes) {
                    set({ recipes: data.Recipes });
                  }
                })
                .catch((error) => console.error("Error refreshing recipes:", error));
            } else if (messageType === "RecipeRolled") {
              console.log("Recipe rolled from WebSocket:", data.RecipeRolled.recipe);
              setRolledRecipe(data.RecipeRolled.recipe);
            } else if (messageType === "RecipesUpdated") {
              console.log("Recipes updated from WebSocket:", data.RecipesUpdated.recipes);
              if (data.RecipesUpdated.recipes) {
                set({ recipes: data.RecipesUpdated.recipes });
              }
            }
          } catch (error) {
            console.error("Error parsing WebSocket message", error);
          }
        },
      });

      setApi(api);
    } else {
      setNodeConnected(false);
    }
  }, []);

  const handleSubmitRecipe = useCallback(
    async (event) => {
      event.preventDefault();

      if (!recipeName || !recipeInstructions) return;

      if (isEditMode && editingRecipeIndex !== null) {
        // Update existing recipe
        console.log("Updating recipe:", recipeName, recipeInstructions);

        // Create a message object to update a recipe
        const updatedRecipe = {
          name: recipeName,
          instructions: recipeInstructions,
        };

        const data = {
          UpdateRecipe: {
            index: editingRecipeIndex,
            recipe: updatedRecipe
          }
        } as UpdateRecipeMessage;

        try {
          const result = await fetch(`${BASE_URL}/recipes`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          });

          if (!result.ok) throw new Error("HTTP request failed");

          // Update local state
          useRecipeDeciderStore.getState().updateRecipe(editingRecipeIndex, updatedRecipe);
          setEditMode(false, null);

          // Reset form
          setRecipeName("");
          setRecipeInstructions("");

          // Refresh the recipe list
          fetch(`${BASE_URL}/recipes`)
            .then((response) => response.json())
            .then((data) => {
              console.log("Updated recipes after update:", data.Recipes);
              if (data.Recipes) {
                set({ recipes: data.Recipes });
              }
            })
            .catch((error) => console.error("Error refreshing recipes:", error));
        } catch (error) {
          console.error("Error updating recipe:", error);
        }
      } else {
        // Add new recipe
        console.log("Adding recipe:", recipeName, recipeInstructions);

        // Create a message object to add a recipe
        const data = {
          AddRecipe: {
            name: recipeName,
            instructions: recipeInstructions,
          },
        } as AddRecipeMessage;

        try {
          console.log("Sending POST request to:", `${BASE_URL}/recipes`);
          const result = await fetch(`${BASE_URL}/recipes`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          });

          if (!result.ok) throw new Error("HTTP request failed");

          // Try to parse the response
          try {
            const responseData = await result.json();
            console.log("Response data:", responseData);

            if (responseData.RecipeAdded && responseData.RecipeAdded.recipe) {
              console.log("Recipe added from response:", responseData.RecipeAdded.recipe);
              addRecipe(responseData.RecipeAdded.recipe);
            } else {
              // Fallback to using the form values
              console.log("Using form values for recipe");
              addRecipe({
                name: recipeName,
                instructions: recipeInstructions,
              });
            }
          } catch (parseError) {
            console.error("Error parsing response:", parseError);
            // Fallback to using the form values
            console.log("Using form values for recipe (after parse error)");
            addRecipe({
              name: recipeName,
              instructions: recipeInstructions,
            });
          }

          // Refresh the list of recipes
          console.log("Refreshing recipe list");
          fetch(`${BASE_URL}/recipes`)
            .then((response) => response.json())
            .then((data) => {
              console.log("Updated recipes:", data.Recipes);
              if (data.Recipes) {
                set({ recipes: data.Recipes });
              }
            })
            .catch((error) => console.error("Error refreshing recipes:", error));

          setRecipeName("");
          setRecipeInstructions("");
        } catch (error) {
          console.error("Error adding recipe:", error);
        }
      }
    },
    [recipeName, recipeInstructions, isEditMode, editingRecipeIndex, addRecipe, setEditMode, set]
  );

  const handleRollRecipe = useCallback(
    async () => {
      if (!api) return;

      // Create a message object to roll a recipe
      const data = {
        RollRecipe: true
      } as RollRecipeMessage;

      try {
        const result = await fetch(`${BASE_URL}/recipes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        if (!result.ok) throw new Error("HTTP request failed");

        const rolledData = await result.json();
        if (rolledData.RolledRecipe && rolledData.RolledRecipe.recipe) {
          setRolledRecipe(rolledData.RolledRecipe.recipe);
        } else {
          setRolledRecipe(null);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [api, setRolledRecipe]
  );

  // For delete confirmation modal
  const { deleteConfirmation, setDeleteConfirmation } = useRecipeDeciderStore();

  // Effect to populate form when entering edit mode
  useEffect(() => {
    if (isEditMode && editingRecipeIndex !== null && recipes[editingRecipeIndex]) {
      const recipeToEdit = recipes[editingRecipeIndex];
      setRecipeName(recipeToEdit.name);
      setRecipeInstructions(recipeToEdit.instructions);

      // Also switch to the input tab
      setCurrentTab('input');
    }
  }, [isEditMode, editingRecipeIndex, recipes, setCurrentTab]);

  // Handle recipe delete
  const handleDeleteRecipe = useCallback(async () => {
    const recipeIndex = deleteConfirmation.recipeIndex;
    if (recipeIndex === null) return;

    try {
      console.log("Deleting recipe with index:", recipeIndex);

      // Create a message object to delete a recipe
      const data = {
        DeleteRecipe: {
          index: recipeIndex
        }
      } as DeleteRecipeMessage;

      // Send delete request to backend
      const result = await fetch(`${BASE_URL}/recipes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!result.ok) {
        throw new Error(`HTTP error! status: ${result.status}`);
      }

      // Update local state
      useRecipeDeciderStore.getState().deleteRecipe(recipeIndex);
      setDeleteConfirmation(false, null);

      // Refresh the recipe list from the server to ensure consistency
      fetch(`${BASE_URL}/recipes`)
        .then((response) => response.json())
        .then((data) => {
          console.log("Updated recipes after delete:", data.Recipes);
          if (data.Recipes) {
            set({ recipes: data.Recipes });
          }
        })
        .catch((error) => console.error("Error refreshing recipes:", error));

    } catch (error) {
      console.error("Error deleting recipe:", error);
    }
  }, [deleteConfirmation.recipeIndex, setDeleteConfirmation, set]);

  return (
    <div style={{ width: "100%" }}>
      {!nodeConnected && (
        <div className="node-not-connected">
          <h2 style={{ color: "red" }}>Node not connected</h2>
          <h4>
            You need to start a node at {PROXY_TARGET} before you can use this UI
            in development.
          </h4>
        </div>
      )}

      <div className="app-header">
        <h2>Recipe Decider</h2>
        <p>Store your favorite recipes and let us pick one for you!</p>
      </div>

      <div className="tabs">
        <button
          className={`tab ${currentTab === 'roll' ? 'active' : ''}`}
          onClick={() => setCurrentTab('roll')}
        >
          Roll Recipe
        </button>
        <button
          className={`tab ${currentTab === 'input' ? 'active' : ''}`}
          onClick={() => setCurrentTab('input')}
        >
          Input Recipe
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={deleteConfirmation.isOpen}
        title="Delete Recipe"
        message="Are you sure you want to delete this recipe? This action cannot be undone."
        onConfirm={handleDeleteRecipe}
        onCancel={() => setDeleteConfirmation(false, null)}
      />

      <div className="card">
        {currentTab === 'roll' ? (
          <div className="roll-tab">
            <button
              onClick={handleRollRecipe}
              className="roll-button"
              disabled={recipes.length === 0}
            >
              Roll
            </button>

            {recipes.length === 0 ? (
              <p>No recipes available. Please add some recipes first.</p>
            ) : (
              <div className="rolled-recipe">
                {rolledRecipe ? (
                  <>
                    <h3>{rolledRecipe.name}</h3>
                    <p>{rolledRecipe.instructions}</p>
                  </>
                ) : (
                  <p>Click "Roll" to get a random recipe.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="input-tab">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  padding: "1.5em",
                  maxHeight: "400px",
                  overflowY: "auto",
                  borderBottom: "1px solid var(--border-color)"
                }}
              >
                <h3 style={{ marginTop: 0 }}>Recipes</h3>
                {recipes.length === 0 ? (
                  <p>No recipes yet. Add your first one!</p>
                ) : (
                  <ul className="recipe-list">
                    {recipes.map((recipe, index) => (
                      <li key={index}>
                        <div className="recipe-item">
                          <h4>{recipe.name}</h4>
                          <p>{recipe.instructions}</p>
                          <div className="recipe-actions">
                            <button
                              className="action-button edit-button"
                              onClick={() => setEditMode(true, index)}
                              title="Edit Recipe"
                            >
                              ✏️
                            </button>
                            <button
                              className="action-button delete-button"
                              onClick={() => setDeleteConfirmation(true, index)}
                              title="Delete Recipe"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                  padding: "1.5em",
                }}
              >
                <h3 style={{ marginTop: 0, textAlign: 'left' }}>
                  {isEditMode ? 'Edit Recipe' : 'Add New Recipe'}
                </h3>
                <form
                  onSubmit={handleSubmitRecipe}
                  style={{ display: "flex", flexDirection: "column" }}
                >
                  <label
                    style={{ fontWeight: 600, alignSelf: "flex-start" }}
                    htmlFor="recipeName"
                  >
                    Recipe Name
                  </label>
                  <input
                    style={{
                      padding: "0.25em 0.5em",
                      fontSize: "1em",
                      marginBottom: "1em",
                    }}
                    type="text"
                    id="recipeName"
                    value={recipeName}
                    onChange={(event) => setRecipeName(event.target.value)}
                    required
                  />

                  <label
                    style={{ fontWeight: 600, alignSelf: "flex-start" }}
                    htmlFor="recipeInstructions"
                  >
                    Instructions
                  </label>
                  <textarea
                    style={{
                      padding: "0.25em 0.5em",
                      fontSize: "1em",
                      marginBottom: "1em",
                      minHeight: "150px",
                    }}
                    id="recipeInstructions"
                    value={recipeInstructions}
                    onChange={(event) => setRecipeInstructions(event.target.value)}
                    required
                  />

                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    {isEditMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditMode(false, null);
                          setRecipeName("");
                          setRecipeInstructions("");
                        }}
                        style={{ marginRight: "10px" }}
                      >
                        Cancel
                      </button>
                    )}
                    <button type="submit" style={{ flexGrow: isEditMode ? 1 : 0 }}>
                      {isEditMode ? 'Save Changes' : 'Add Recipe'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
