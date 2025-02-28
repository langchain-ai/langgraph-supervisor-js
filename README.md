> [!IMPORTANT]
> The code for this project has moved into the [LangGraph JS monorepo](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph-supervisor).

# 🤖 LangGraph Multi-Agent Supervisor

A JavaScript library for creating hierarchical multi-agent systems using [LangGraph](https://github.com/langchain-ai/langgraphjs). Hierarchical systems are a type of [multi-agent](https://langchain-ai.github.io/langgraphjs/concepts/multi_agent) architecture where specialized agents are coordinated by a central **supervisor** agent. The supervisor controls all communication flow and task delegation, making decisions about which agent to invoke based on the current context and task requirements.

## Features

- 🤖 **Create a supervisor agent** to orchestrate multiple specialized agents
- 🛠️ **Tool-based agent handoff mechanism** for communication between agents
- 📝 **Flexible message history management** for conversation control

This library is built on top of [LangGraph](https://github.com/langchain-ai/langgraphjs), a powerful framework for building agent applications, and comes with out-of-box support for [streaming](https://langchain-ai.github.io/langgraphjs/how-tos/#streaming), [short-term and long-term memory](https://langchain-ai.github.io/langgraphjs/concepts/memory/) and [human-in-the-loop](https://langchain-ai.github.io/langgraphjs/concepts/human_in_the_loop/)

## Installation