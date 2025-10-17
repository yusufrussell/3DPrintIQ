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


app = Flask(__name__)

# Session configuration
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

openai.api_key = "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"
app.secret_key = "supersecretkey"

# Open and read txt file, create variable for the contents
with open("topic_prompts/directive.txt", "r") as file:
    additional_context = file.read()

# Function to extract context from the assistant's response
def extract_fire_alert_from_response(response_text):
    return response_text.strip()

# Function to determine the fire risk level from the assistant's response
def determine_fire_risk_level(fire_alert_context):
    if "Warning: Fire Emergency Detected" in fire_alert_context:
        return "imminent fire emergency"
    elif "Caution: High Fire Risk" in fire_alert_context:
        return "high-risk fire hazard"
    elif "Reminder: Fire Safety Notice" in fire_alert_context:
        return "moderate fire hazard"
    else:
        return "no fire hazard"

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

    # Construct the messages as per OpenAI's vision API
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"You create fire risk messages based on the context you get from images taken from camera feeds, ensuring tailored warnings and guidance for users depending on the severity of the situation. "
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

        # Extract fire alert context from the response
        fire_alert_context = extract_fire_alert_from_response(gpt_response)

        # Store context in the session
        session["fire_alert_context"] = fire_alert_context

        # Determine the fire risk level
        risk_level = determine_fire_risk_level(fire_alert_context)

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
    app.run(debug=True, port=8080)