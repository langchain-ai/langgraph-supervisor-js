import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { StructuredToolInterface } from "@langchain/core/tools";
import { RunnableToolLike } from "@langchain/core/runnables";
import {
  START,
  StateGraph,
  CompiledStateGraph,
  AnnotationRoot,
} from "@langchain/langgraph";
import {
  createReactAgent,
  CreateReactAgentParams,
} from "@langchain/langgraph/prebuilt";
import { createHandoffTool, createHandoffBackMessages } from "./handoff.js";

type OutputMode = "full_history" | "last_message";

const makeCallAgent = (
  agent: any,
  outputMode: OutputMode,
  addHandoffBackMessages: boolean,
  supervisorName: string
) => {
  if (!["full_history", "last_message"].includes(outputMode)) {
    throw new Error(
      `Invalid agent output mode: ${outputMode}. Needs to be one of ["full_history", "last_message"]`
    );
  }

  return (state: Record<string, any>) => {
    const output = agent.invoke(state);
    let messages = output.messages;

    if (outputMode === "last_message") {
      messages = messages.slice(-1);
    }

    if (addHandoffBackMessages) {
      messages.push(...createHandoffBackMessages(agent.name, supervisorName));
    }

    return { messages };
  };
};

const createSupervisor = <A extends AnnotationRoot<any> = AnnotationRoot<{}>>({
  agents,
  llm,
  tools,
  prompt,
  stateSchema,
  outputMode = "last_message",
  addHandoffBackMessages = true,
  supervisorName = "supervisor",
}: {
  agents: CompiledStateGraph<any, any, any, any, any, any>[];
  llm: BaseChatModel;
  tools?: (StructuredToolInterface | RunnableToolLike)[];
  // TODO: update this to use 'prompt'
  prompt?: CreateReactAgentParams["stateModifier"];
  stateSchema?: A;
  outputMode?: OutputMode;
  addHandoffBackMessages?: boolean;
  supervisorName?: string;
}) => {
  const agentNames = new Set();

  for (const agent of agents) {
    if (!agent.name || agent.name === "LangGraph") {
      throw new Error(
        "Please specify a name when you create your agent, either via `createReactAgent(..., name=agentName)` " +
          "or via `graph.compile(name=name)`."
      );
    }

    if (agentNames.has(agent.name)) {
      throw new Error(
        `Agent with name '${agent.name}' already exists. Agent names must be unique.`
      );
    }

    agentNames.add(agent.name);
  }

  const handoffTools = agents.map((agent) =>
    createHandoffTool({ agentName: agent.name as string })
  );
  const allTools = [...(tools ?? []), ...(handoffTools ?? [])];

  // TODO: figure out a better way to do this
  //   if (model.bindTools && "parallelToolCalls" in model.bindTools) {
  //     model = model.bindTools(allTools, { parallelToolCalls: false });
  //   }

  const supervisorAgent = createReactAgent({
    name: supervisorName,
    llm,
    tools: allTools,
    // TODO: update this to use 'prompt'
    stateModifier: prompt,
    stateSchema,
  });

  const builder = new StateGraph(stateSchema)
    .addNode(supervisorAgent.name as string, supervisorAgent) //
    .addEdge(START, supervisorAgent.name as string);

  for (const agent of agents) {
    builder.addNode(
      agent.name as string,
      makeCallAgent(agent, outputMode, addHandoffBackMessages, supervisorName)
    );
  }

  return builder;
};

export { createSupervisor, type OutputMode };
