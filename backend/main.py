import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from dotenv import load_dotenv

# Automatically load API keys from a .env file if it exists
load_dotenv()

# --- API Keys ---
# We look for your local environment variables first.
# If they are not found, we fall back to your custom string placeholders.
os.environ["GOOGLE_API_KEY"] = os.getenv("GOOGLE_API_KEY", "jango")
os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY", "gringo")

# --- LangChain & Gemini Imports ---
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

# --- App Setup ---
app = FastAPI(title="PantryToPlate Gemini Engine")
origins = [
    "http://localhost:5173",
    "https://pantry-to-plate.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    #allow_origins=["http://localhost:5173"],
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Recipes & Matcher Schemas ---
class PantryRequest(BaseModel):
    ingredients: List[str]

# Defining this Pydantic model forces Gemini to structure its response in this exact format.
class RecipeResponse(BaseModel):
    title: str = Field(description="Name of the recipe dish")
    source: str = Field(description="Source of the recipe, e.g., 'Web Search' or culinary blog name")
    prepTime: str = Field(description="Preparation time, e.g., '10 mins'")
    cookTime: str = Field(description="Cooking time, e.g., '15 mins'")
    servings: int = Field(description="Number of servings, must be an integer")
    ingredients: List[str] = Field(description="List of ingredients formatted with quantities, e.g., ['2 chicken breasts', '1 cup heavy cream']")
    steps: List[str] = Field(description="Ordered, sequential step-by-step instructions to cook the dish")

# --- Chatbot Schemas ---
class ChatMessage(BaseModel):
    role: str # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage]
    pantry: List[str] = []
    current_recipe: Optional[dict] = None

# --- LLM Setup with Structured Output ---
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.3,
)

# Bind the schema directly to the model
structured_llm = llm.with_structured_output(RecipeResponse)

# --- Recipe Generation Prompt ---
recipe_prompt = ChatPromptTemplate.from_messages([
    ("system", (
        "You are 'Chef Agent', an expert culinary AI system.\n\n"
        "Your task is to take a list of user ingredients, formulate a recipe, and "
        "provide a highly detailed structured response matching the requested schema."
    )),
    ("human", "Find me a great recipe using these ingredients: {input}")
])

# Because structured_llm is used, the chain outputs a validated Pydantic model directly.
recipe_chain = recipe_prompt | structured_llm

# --- Match Recipe Endpoint ---
@app.post("/api/match-recipe")
async def match_recipe(request: PantryRequest):
    ingredients_str = ", ".join(request.ingredients)
    print(f"Gemini Chef Agent processing ingredients: {ingredients_str}")
    try:
        # Re-execute the chain using our structured prompt pipeline
        structured_recipe = recipe_chain.invoke({"input": ingredients_str})
        # FastAPI automatically serializes Pydantic models directly to clean JSON!
        return structured_recipe
    except Exception as e:
        print(f"Error during Gemini recipe generation: {e}")
        # Secure fallback schema so the frontend UI doesn't crash on network exceptions
        return {
            "title": "Quick Skillet Medley",
            "source": "Agent Fallback Routine",
            "prepTime": "5 mins",
            "cookTime": "10 mins",
            "servings": 2,
            "ingredients": [f"{i} (as available)" for i in request.ingredients],
            "steps": ["Combine ingredients in a skillet.", "Cook thoroughly over medium heat."]
        }

# --- Chatbot Cooking Coach Endpoint ---
@app.post("/api/chat")
async def chat_coach(request: ChatRequest):
    print(f"Sous-Chef Chatbot processing message: '{request.message}'")
    
    # Base system instructions setting up the interactive RAG-like cooking coach
    system_instruction = (
        "You are 'Chef Coach', a friendly, world-class culinary instructor and real-time cooking guide.\n"
        "Your primary task is to guide the user step-by-step through cooking any dish they specify, "
        "or answer cooking questions about recipes, ingredients, substitutions, and techniques.\n\n"
        "GUIDELINES:\n"
        "1. If the user names a dish to cook (e.g., 'Lasagna', 'Risotto'), begin the coaching session. "
        "Give a 1-sentence mouthwatering summary, list key required ingredients, and present 'STEP 1' clearly. "
        "Ask them to say 'Next' when they are ready.\n"
        "2. Break instructions down step-by-step. Do not dump the entire recipe at once unless specifically requested. "
        "Walk them through sequentially. Keep individual steps bite-sized and actionable.\n"
        "3. Cross-reference the user's available pantry ingredients if provided. If they have some required ingredients, "
        "enthusiastically point it out (e.g., 'I see you already have the chicken and garlic in your pantry!').\n"
        "4. If they ask for substitutions, explain techniques (like 'how to fold dough' or 'deglaze'), or ask for a timer, "
        "provide helpful, chef-level advice.\n"
        "5. Keep your tone encouraging, professional, and culinary-focused."
    )
    
    # Formulate contextual information
    pantry_context = f"User's available pantry ingredients: {', '.join(request.pantry)}" if request.pantry else "User's pantry is currently empty."
    recipe_context = ""
    if request.current_recipe:
        recipe_context = f"Currently active matched recipe details:\n{str(request.current_recipe)}"
        
    full_system_context = f"{system_instruction}\n\n[CONTEXT]\n{pantry_context}\n{recipe_context}"
    
    # Rebuild conversation history
    messages = [SystemMessage(content=full_system_context)]
    for msg in request.history:
        if msg.role == 'user':
            messages.append(HumanMessage(content=msg.content))
        else:
            messages.append(AIMessage(content=msg.content))
            
    # Add new user prompt
    messages.append(HumanMessage(content=request.message))
    
    try:
        response = llm.invoke(messages)
        return {"response": response.content}
    except Exception as e:
        print(f"Error in chat coach: {e}")
        return {"response": "I apologize, Chef! I lost my connection to the spice rack. Could you repeat that?"}
