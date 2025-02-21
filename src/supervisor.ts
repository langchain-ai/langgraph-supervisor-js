import { LanguageModelLike } from "@langchain/core/language_models/base";
import { StructuredToolInterface, DynamicTool } from "@langchain/core/tools";
import { RunnableToolLike } from "@langchain/core/runnables";
import {
  START,
  StateGraph,
  CompiledStateGraph,
  AnnotationRoot,
} from "@langchain/langgraph";
import {
  createReactAgent,
  createReactAgentAnnotation,
  CreateReactAgentParams,
} from "@langchain/langgraph/prebuilt";
import { createHandoffTool, createHandoffBackMessages } from "./handoff.js";
import {
  BaseChatModel,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";

type OutputMode = "full_history" | "last_message";
const PROVIDERS_WITH_PARALLEL_TOOL_CALLS_PARAM = new Set(["ChatOpenAI"]);

// type guards
type ChatModelWithBindTools = BaseChatModel & {
  bindTools(tools: BindToolsInput[], kwargs?: any): LanguageModelLike;
};
type ChatModelWithParallelToolCallsParam = BaseChatModel & {
  bindTools(
    tools: BindToolsInput[],
    kwargs?: { parallel_tool_calls?: boolean } & Record<string, any>
  ): LanguageModelLike;
};
function isChatModelWithBindTools(
  llm: LanguageModelLike
): llm is ChatModelWithBindTools {
  return (
    "_modelType" in llm &&
    typeof llm._modelType === "function" &&
    llm._modelType() === "base_chat_model" &&
    "bindTools" in llm &&
    typeof llm.bindTools === "function"
  );
}

function isChatModelWithParallelToolCallsParam(
  llm: ChatModelWithBindTools
): llm is ChatModelWithParallelToolCallsParam {
  return llm.bindTools.length >= 2;
}

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

  return async (state: Record<string, any>) => {
    const output = await agent.invoke(state);
    let messages = output.messages;

    if (outputMode === "last_message") {
      messages = messages.slice(-1);
    }

    if (addHandoffBackMessages) {
      messages.push(...createHandoffBackMessages(agent.name, supervisorName));
    }
    return { ...output, messages };
  };
};

export type CreateSupervisorParams<
  AnnotationRootT extends AnnotationRoot<any>
> = {
  agents: CompiledStateGraph<
    AnnotationRootT["State"],
    AnnotationRootT["Update"]
  >[];
  llm: LanguageModelLike;
  tools?: (StructuredToolInterface | RunnableToolLike | DynamicTool)[];
  prompt?: CreateReactAgentParams["prompt"];
  stateSchema?: AnnotationRootT;
  outputMode?: OutputMode;
  addHandoffBackMessages?: boolean;
  supervisorName?: string;
};

/**
 * Create a multi-agent supervisor.
 *
 * @param agents List of agents to manage
 * @param llm Language model to use for the supervisor
 * @param tools Tools to use for the supervisor
 * @param prompt Optional prompt to use for the supervisor. Can be one of:
 *   - string: This is converted to a SystemMessage and added to the beginning of the list of messages in state["messages"]
 *   - SystemMessage: this is added to the beginning of the list of messages in state["messages"]
 *   - Function: This function should take in full graph state and the output is then passed to the language model
 *   - Runnable: This runnable should take in full graph state and the output is then passed to the language model
 * @param stateSchema State schema to use for the supervisor graph
 * @param outputMode Mode for adding managed agents' outputs to the message history in the multi-agent workflow.
 *   Can be one of:
 *   - `full_history`: add the entire agent message history
 *   - `last_message`: add only the last message (default)
 * @param addHandoffBackMessages Whether to add a pair of (AIMessage, ToolMessage) to the message history
 *   when returning control to the supervisor to indicate that a handoff has occurred
 * @param supervisorName Name of the supervisor node
 */
const createSupervisor = <AnnotationRootT extends AnnotationRoot<any> = AnnotationRoot<{}>>({
  agents,
  llm,
  tools,
  prompt,
  stateSchema,
  outputMode = "last_message",
  addHandoffBackMessages = true,
  supervisorName = "supervisor",
}: CreateSupervisorParams<AnnotationRootT>) => {
  const agentNames = new Set<string>();

  for (const agent of agents) {
    if (!agent.name || agent.name === "LangGraph") {
      throw new Error(
        "Please specify a name when you create your agent, either via `createReactAgent({ ..., name: agentName })` " +
          "or via `graph.compile({ name: agentName })`."
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
  const allTools = [...(tools ?? []), ...handoffTools];

  let supervisorLLM = llm;
  if (isChatModelWithBindTools(llm)) {
    if (
      isChatModelWithParallelToolCallsParam(llm) &&
      PROVIDERS_WITH_PARALLEL_TOOL_CALLS_PARAM.has(llm.getName())
    ) {
      supervisorLLM = llm.bindTools(allTools, { parallel_tool_calls: false });
    } else {
      supervisorLLM = llm.bindTools(allTools);
    }
  }

  const supervisorAgent = createReactAgent({
    name: supervisorName,
    llm: supervisorLLM,
    tools: allTools,
    prompt,
    stateSchema: stateSchema ?? createReactAgentAnnotation(),
  });

  const builder = new StateGraph(stateSchema ?? createReactAgentAnnotation())
    .addNode(supervisorAgent.name as string, supervisorAgent, {
      ends: [...agentNames],
    })
    .addEdge(START, supervisorAgent.name as string);

  for (const agent of agents) {
    builder.addNode(
      agent.name as string,
      makeCallAgent(agent, outputMode, addHandoffBackMessages, supervisorName)
    );
    builder.addEdge(agent.name as string, supervisorAgent.name as string);
  }

  return builder;
};

export { createSupervisor, type OutputMode };
