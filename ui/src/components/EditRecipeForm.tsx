import React, { useState, useEffect } from 'react';
import { Recipe } from '../types/RecipeDecider';

interface EditRecipeFormProps {
  recipe: Recipe;
  onSave: (updatedRecipe: Recipe) => void;
  onCancel: () => void;
}

const EditRecipeForm: React.FC<EditRecipeFormProps> = ({
  recipe,
  onSave,
  onCancel
}) => {
  const [name, setName] = useState(recipe.name);
  const [instructions, setInstructions] = useState(recipe.instructions);

  useEffect(() => {
    setName(recipe.name);
    setInstructions(recipe.instructions);
  }, [recipe]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      instructions
    });
  };

  return (
    <form onSubmit={handleSubmit} className="edit-recipe-form">
      <h4 className="form-title">Edit Recipe</h4>
      
      <div className="form-group">
        <label htmlFor="edit-name">Recipe Name</label>
        <input
          id="edit-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      
      <div className="form-group">
        <label htmlFor="edit-instructions">Instructions</label>
        <textarea
          id="edit-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          required
          rows={5}
        />
      </div>
      
      <div className="form-actions">
        <button type="button" className="cancel-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="save-button">
          Save Changes
        </button>
      </div>
    </form>
  );
};

export default EditRecipeForm;