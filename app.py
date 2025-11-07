from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    flash,
    jsonify,
    session,
)
from flask_session import Session
import openai
import os
import base64
import re
import requests
import logging
from dotenv import load_dotenv

# For Discord bot
import discord
from discord.ext import commands
import asyncio 
import threading
import io

discord_alert_queue = asyncio.Queue()

app = Flask(__name__)

# Session configuration
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
app.secret_key = "supersecretkey"
token = os.getenv("DISCORD_TOKEN")
channel_id = os.getenv("CHANNEL_ID")

handler = logging.FileHandler(filename='discord.log', encoding='utf-8', mode='w')
intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix='!', intents=intents)

# Bot setup
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (ID: {bot.user.name})")
    bot.loop.create_task(discord_alert())

# Create Discord alert
async def discord_alert():
    await bot.wait_until_ready()
    channel = bot.get_channel(int(channel_id))
    print(f"[🔊🔊🔊] Found channel: {channel}")
    while not bot.is_closed():
        item = await discord_alert_queue.get()
        if isinstance(item, tuple) and len(item) == 2:
            message, level = item
        else:
            message = item
        if level == "High":
            if "Spaghettification" in message:
                embed = discord.Embed(title="Sphaghettification Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            elif "Shifting" in message:
                embed = discord.Embed(title="Layer Shifting Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")    
            elif "Warping" in message:
                embed = discord.Embed(title="Warping Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            else:
                embed = discord.Embed(title="Stringing Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
        elif level == "Moderate":
            if "Spaghettification" in message:
                embed = discord.Embed(title="Sphaghettification Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            elif "Shifting" in message:
                embed = discord.Embed(title="Layer Shifting Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")    
            elif "Warping" in message:
                embed = discord.Embed(title="Warping Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            else:
                embed = discord.Embed(title="Stringing Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
        else:
            if "Spaghettification" in message:
                embed = discord.Embed(title="Sphaghettification Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            elif "Shifting" in message:
                embed = discord.Embed(title="Layer Shifting Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")    
            elif "Warping" in message:
                embed = discord.Embed(title="Warping Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
            else:
                embed = discord.Embed(title="Stringing Detected", description=message, color=0xFF0000)
                embed.set_image(url="attachment://error_detection.jpg")
        await channel.send(embed=embed, file=discord_image_file)
        discord_alert_queue.task_done()

# Start bot in seperate thread
def start_discord_bot():
    async def runner():
        await bot.start(token)

    def thread_target():
        asyncio.run(runner())

    threading.Thread(target=thread_target, daemon=True).start()

# Open and read txt file, create variable for the contents
with open("topic_prompts/directive.txt", "r", encoding="utf-8") as file:
    additional_context = file.read()

# Function to extract context from the assistant's response
def extract_error_alert_from_response(response_text):
    return response_text.strip()

# Function to determine the error risk level from the assistant's response
def determine_error_risk_level(error_alert_context):
    if "High" in error_alert_context:
        return "High-risk error"
    elif "Moderate" in error_alert_context:
        return "Moderate-risk error"
    elif "Low" in error_alert_context:
        return "Low-risk error"
    else:
        return "no error hazard"

@app.route("/")
def home():
    return render_template("home.html")

# New route to process images from the webcam
@app.route("/process_image", methods=["POST"])
def process_image():
    data = request.get_json()
    image_data = data.get("image_data")

    if not image_data:
        return jsonify({"error": "No image data provided."}), 400

    # Remove the data URL prefix to get the base64-encoded image data
    image_base64 = re.sub('^data:image/.+;base64,', '', image_data)

    # Prepare the image data for the OpenAI API
    image_url = f"data:image/jpeg;base64,{image_base64}"

    # Create a file-like object for Discord
    image_bytes = base64.b64decode(image_base64)
    image_mem_file = io.BytesIO(image_bytes)
    global discord_image_file
    discord_image_file = discord.File(fp=image_mem_file, filename="error_detection.jpg")
    discord_image_file_embed = discord.Embed(title="Captured Image", description="Image captured from camera feed.")
    discord_image_file_embed.set_image(url="attachment://error_detection.jpg")

    # Construct the messages as per OpenAI's vision API
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"You create 3D print error messages based on the context you get from images taken from camera feeds, ensuring tailored warnings and guidance for users depending on the severity of the situation. "
                        f"Use the following context to guide your response:\n\n{additional_context}"
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {"url": image_url}
                }
            ]
        }
    ]

    try:
        # Call the OpenAI API with the image
        response = openai.chat.completions.create(
            model="gpt-4-turbo-2024-04-09",
            messages=messages,
            max_tokens=500
        )
        # Extract the assistant's response
        gpt_response = response.choices[0].message.content

        # Extract 3D printed error alert context from the response
        error_alert_context = extract_error_alert_from_response(gpt_response)

        # Store context in the session
        session["error_alert_context"] = error_alert_context

        # Determine the error risk level
        risk_level = determine_error_risk_level(error_alert_context)
        print(f"[❗❗❗] Risk level determined: {risk_level}")

        # Create discord message
        if risk_level != "no error hazard":
            discord_message = f"{error_alert_context}" # Change to AI response
            if "High" in risk_level:
                level = "High"
            elif "Moderate" in risk_level:
                level = "Moderate"
            else:
                level = "Low"
            asyncio.run_coroutine_threadsafe(discord_alert_queue.put((discord_message, level)), bot.loop)

        return jsonify({"context": error_alert_context, "risk_level": risk_level})

    except Exception as e:
        app.logger.error(f"An error occurred: {e}")
        return jsonify({"error": str(e)}), 500

# Clear session route
@app.route("/clear_session", methods=["GET"])
def clear_session():
    # Clear the session
    session.clear()
    return jsonify({"status": "session cleared"})

if __name__ == "__main__":
    start_discord_bot()
    app.run(debug=True, port=8080)
