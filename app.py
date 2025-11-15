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
import websocket
import json
from typing import Dict, Any

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

# WebSocket 3D Printer Connection (Read Only)
ws = websocket.WebSocket() 
ws_connected = False

class Printer():
    def __init__(self, ip, ws_port):
        self.ip = ip
        self.ws_port = ws_port
        self._nozzle_pos = None
        self._nozzle_temp = None
        self._bed_temp = None
        self._layer = None
        self._time_elapsed = None
        self._time_remaining = None
        self._current_file = None
        self._printing = False
        self._paused = False
        self.cached_json = {}
    
    def start_connection(self):
        global ws_connected
        
        try:
            ws.connect(f'ws://{self.ip}:{self.ws_port}')
            ws_connected = True
            return "Successfully Connected to 3D Printer"
        except TimeoutError:
            return "Printer not active or incorrect IP given"

    async def update_loop(self):
        global ws_connected
        prev_layer = 0
        while ws_connected:
            try:
                msg = {"id": 1, "method": "printer.info", "params": {}}
                ws.send(json.dumps(msg))
                response = ws.recv()
                self.cached_json.update(json.loads(response))
                if prev_layer != self.layer and self.layer != 0:
                    print(f'Next layer: {self.layer}')
                prev_layer = self.layer
                await asyncio.sleep(1.0)
            except TimeoutError:
                ws_connected = False


    @property
    def info_json(self):
        return self.cached_json
    
    @property
    def nozzle_pos(self):
        return self.cached_json.get('curPosition')
        
    @property
    def nozzle_temp(self):
        return self.cached_json.get('nozzleTemp')

    @property
    def bed_temp(self):
        return self.cached_json.get('bedTemp0')

    @property
    def layer(self):
        return self.cached_json.get('layer')

    @property
    def time_elapsed(self):
        return self.cached_json.get('printJobTime')

    @property
    def time_remaining(self):
        return self.cached_json.get('printLeftTime')

    @property
    def current_file(self):
        return self.cached_json.get('printFileName')

    @property
    def printing(self):
        return True if self.cached_json.get('deviceState') == 1 else False

    @property
    def paused(self):
        return True if self.cached_json.get('state') == 5 else False
    
    @property
    def flow(self):
        return self.cached_json.get('realTimeFlow')
    
    @property
    def speed(self):
        return self.cached_json.get('realTimeSpeed')


printer_ip = '192.168.1.130'
printer_ws_port = '9999'

printer = Printer(printer_ip, printer_ws_port)

# Bot setup
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (ID: {bot.user.name})")
    bot.loop.create_task(discord_alert())
    
    bot.loop.create_task(printer.update_loop())

    # Debug Printer Info
    # bot.loop.create_task(debug_printer_monitor())

# async def debug_printer_monitor():
#     while True:
#         print("[LIVE]", printer.nozzle_pos, printer.nozzle_temp, printer.bed_temp, printer.layer)
#         await asyncio.sleep(1)

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
    connection_status = printer.start_connection()
    print(connection_status)
    start_discord_bot()
    try:
        app.run(debug=True, port=8080)
    finally:
        ws.close() if ws_connected else None